import 'colors';
import fs from 'fs';
import path from 'path';
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
    const [template, configRaw, placementRaw, query, queryParamsRaw] = await Promise.all([
        readFileIfExists(path.join(widgetDir, 'widget.html')),
        readFileIfExists(path.join(widgetDir, 'config.json')),
        readFileIfExists(path.join(widgetDir, 'placement.json')),
        readFileIfExists(path.join(widgetDir, 'query.graphql')),
        readFileIfExists(path.join(widgetDir, 'queryParams.json')),
    ]);

    if (!template) {
        return null;
    }

    if (!placementRaw) {
        return null;
    }

    let placement;
    try {
        placement = JSON.parse(placementRaw);
    } catch {
        console.error(`Invalid placement.json in ${widgetDir}`.red);
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
        placements: placement.placements || [],
        query: query || '',
        queryParams,
    };
}

async function scanWidgetDirs(widgetsDir) {
    let entries;
    try {
        entries = await fs.promises.readdir(widgetsDir, { withFileTypes: true });
    } catch {
        console.error(`Could not read widgets directory: ${widgetsDir}`.red);
        return [];
    }

    const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(widgetsDir, e.name));

    const results = await Promise.all(dirs.map(loadWidgetDir));
    return results.filter(Boolean);
}

function matchesPlacements(widget, pageType, entityId) {
    if (!pageType) return [];

    const upperPageType = pageType.toUpperCase();

    return widget.placements.filter((p) => {
        if (p.page_type.toUpperCase() !== upperPageType) {
            return false;
        }

        if (isGlobalRegion(p.region)) {
            return true;
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
 * Render all local widgets matching the current page and merge into a region map.
 *
 * @param {object} options
 * @param {string} options.widgetsDir - absolute path to the widgets directory
 * @param {string} options.pageType - uppercase page type (e.g. "HOME", "PRODUCT")
 * @param {number|undefined} options.entityId
 * @param {string} options.accessToken
 * @param {string} options.apiHost
 * @param {string} options.storeHash
 * @param {number} [options.channelId]
 * @returns {Promise<object>} - map of regionName -> html string
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
    const widgets = await scanWidgetDirs(widgetsDir);
    const regionEntries = [];

    for (const widget of widgets) {
        const matched = matchesPlacements(widget, pageType, entityId);
        if (matched.length === 0) continue;

        // eslint-disable-next-line no-await-in-loop
        const html = await renderWidgetViaPreviewApi({
            widget,
            accessToken,
            apiHost,
            storeHash,
            channelId,
        });

        if (!html) continue;

        for (const placement of matched) {
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
    for (const entry of widgetEntries) {
        const existing = formattedRegions[entry.region] || '';
        if (entry.position === 'append') {
            // eslint-disable-next-line no-param-reassign
            formattedRegions[entry.region] = existing + entry.html;
        } else {
            // eslint-disable-next-line no-param-reassign
            formattedRegions[entry.region] = entry.html + existing;
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
