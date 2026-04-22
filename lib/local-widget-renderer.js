import 'colors';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import uuid4 from 'uuid4';
import NetworkUtils from './utils/NetworkUtils.js';

const networkUtils = new NetworkUtils();

const widgetRenderCache = new Map();

function isGlobalRegion(regionName) {
    return regionName.endsWith('--global');
}

async function readFileIfExists(filePath) {
    try {
        return await fs.promises.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

async function loadWidgetDir(widgetDir) {
    const [template, configRaw, query, queryParamsRaw] = await Promise.all([
        readFileIfExists(path.join(widgetDir, 'widget.html')),
        readFileIfExists(path.join(widgetDir, 'config.json')),
        readFileIfExists(path.join(widgetDir, 'query.graphql')),
        readFileIfExists(path.join(widgetDir, 'queryParams.json')),
    ]);

    if (!template) {
        return null;
    }

    let config = {};
    if (configRaw) {
        try {
            config = JSON.parse(configRaw);
        } catch {
            console.error(`Invalid config.json in ${widgetDir}`.red);
        }
    }

    let queryParams = {};
    if (queryParamsRaw) {
        try {
            queryParams = JSON.parse(queryParamsRaw);
        } catch {
            console.error(`Invalid queryParams.json in ${widgetDir}`.red);
        }
    }

    return {
        name: path.basename(widgetDir),
        dir: widgetDir,
        template,
        config,
        query: query || '',
        queryParams,
    };
}

async function loadPlacements(widgetsDir) {
    const filePath = path.join(widgetsDir, 'placements.mjs');
    try {
        await fs.promises.access(filePath);
    } catch {
        return [];
    }

    try {
        const fileUrl = pathToFileURL(filePath).href + `?t=${Date.now()}`;
        // eslint-disable-next-line node/no-unsupported-features/es-syntax
        const mod = await import(fileUrl);
        return mod.placements || [];
    } catch (err) {
        console.error(`Failed to load placements.mjs in ${widgetsDir}: ${err.message}`.red);
        return [];
    }
}

async function loadWidgetsByName(widgetsDir, placements) {
    const widgetNames = new Set();
    for (const p of placements) {
        for (const name of p.widgets || []) {
            widgetNames.add(name);
        }
    }

    const entries = await Promise.all(
        [...widgetNames].map(async (name) => {
            const widgetDir = path.join(widgetsDir, name);
            const widget = await loadWidgetDir(widgetDir);
            if (!widget) {
                console.warn(
                    `Widget folder "${name}" referenced in placements.mjs could not be loaded`
                        .yellow,
                );
            }
            return [name, widget];
        }),
    );

    return new Map(entries.filter(([, w]) => w !== null));
}

function matchesPlacements(placements, pageType, entityId) {
    const upperPageType = pageType ? pageType.toUpperCase() : null;

    return placements.filter((p) => {
        if (isGlobalRegion(p.region)) {
            return true;
        }

        if (!upperPageType) {
            return false;
        }

        if (p.page_type.toUpperCase() !== upperPageType) {
            return false;
        }

        if (p.entity_id !== null && p.entity_id !== undefined) {
            return p.entity_id === entityId;
        }

        return true;
    });
}

function buildPreviewPayload(widget, channelId) {
    return {
        widget_configuration: widget.config,
        widget_template: widget.template,
        placement_uuid: uuid4(),
        widget_uuid: uuid4(),
        storefront_api_query: widget.query,
        storefront_api_query_params: widget.queryParams,
        channel_id: channelId || 1,
    };
}

async function renderWidgetViaPreviewApi({ widget, accessToken, apiHost, storeHash, channelId }) {
    const cacheKey = widget.dir;
    const cached = widgetRenderCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const payload = buildPreviewPayload(widget, channelId);
    const apiUrl = `${apiHost}/stores/${storeHash}/v3/content/widget-templates/preview`;

    try {
        const response = await networkUtils.sendApiRequest({
            url: apiUrl,
            method: 'POST',
            accessToken,
            headers: {
                'content-type': 'application/json',
            },
            data: JSON.stringify(payload),
        });

        const html = response.data?.data?.html || '';
        widgetRenderCache.set(cacheKey, html);
        return html;
    } catch (err) {
        if (err.response && err.response.status === 403) {
            console.error(
                'Widget Preview API returned 403. Ensure your access token has the "content manage" scope.'
                    .red,
            );
        } else {
            console.error(`Failed to render widget "${widget.name}": ${err.message}`.red);
        }
        return '';
    }
}

/**
 * Render local widgets whose placements match the current page.
 * Global region placements (region ending with "--global") are always included
 * regardless of pageType. Non-global placements are matched by pageType/entityId.
 *
 * @param {object} options
 * @param {string} options.widgetsDir - absolute path to the widgets directory
 * @param {string} [options.pageType] - page type (e.g. "HOME", "PRODUCT"); may be null
 * @param {number|undefined} options.entityId
 * @param {string} options.accessToken
 * @param {string} options.apiHost
 * @param {string} options.storeHash
 * @param {number} [options.channelId]
 * @returns {Promise<Array<{region: string, html: string, position: string}>>}
 */
async function getRenderedWidgetsForPage({
    widgetsDir,
    pageType,
    entityId,
    accessToken,
    apiHost,
    storeHash,
    channelId,
}) {
    const placements = await loadPlacements(widgetsDir);
    const matched = matchesPlacements(placements, pageType, entityId);
    if (matched.length === 0) return [];

    const widgetMap = await loadWidgetsByName(widgetsDir, matched);
    const regionEntries = [];

    for (const placement of matched) {
        const widgetNames = placement.widgets || [];
        for (const name of widgetNames) {
            const widget = widgetMap.get(name);
            if (!widget) continue;

            // eslint-disable-next-line no-await-in-loop
            const html = await renderWidgetViaPreviewApi({
                widget,
                accessToken,
                apiHost,
                storeHash,
                channelId,
            });

            if (!html) continue;

            regionEntries.push({
                region: placement.region,
                html,
                position: placement.position || 'prepend',
            });
        }
    }

    return regionEntries;
}

/**
 * Merge local widget HTML entries into the existing formattedRegions map (mutates in place).
 *
 * @param {object} formattedRegions - { regionName: html }
 * @param {Array<{region: string, html: string, position: string}>} widgetEntries
 */
function mergeWidgetRegions(formattedRegions, widgetEntries) {
    const groups = new Map();
    for (const entry of widgetEntries) {
        if (!groups.has(entry.region)) {
            groups.set(entry.region, { position: entry.position, htmlParts: [] });
        }
        groups.get(entry.region).htmlParts.push(entry.html);
    }

    for (const [region, { position, htmlParts }] of groups) {
        const combined = htmlParts.join('');
        const existing = formattedRegions[region] || '';
        if (position === 'append') {
            // eslint-disable-next-line no-param-reassign
            formattedRegions[region] = existing + combined;
        } else {
            // eslint-disable-next-line no-param-reassign
            formattedRegions[region] = combined + existing;
        }
    }
}

function invalidateCache(widgetDir) {
    widgetRenderCache.delete(widgetDir);
}

function invalidateAllCaches() {
    widgetRenderCache.clear();
}

export default {
    getRenderedWidgetsForPage,
    mergeWidgetRegions,
    invalidateCache,
    invalidateAllCaches,
};
