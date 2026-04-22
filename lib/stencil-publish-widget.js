import 'colors';
import fs from 'fs';
import path from 'path';
import StencilConfigManager from './StencilConfigManager.js';
import themeApiClient from './theme-api-client.js';
import NetworkUtils from './utils/NetworkUtils.js';

const networkUtils = new NetworkUtils();

async function readFileIfExists(filePath) {
    try {
        return await fs.promises.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

function readTrackedUuid(widgetDir) {
    try {
        const data = fs.readFileSync(path.join(widgetDir, 'widget.yml'), 'utf-8');
        return data.trim() || null;
    } catch {
        return null;
    }
}

function writeTrackedUuid(widgetDir, uuid) {
    fs.writeFileSync(path.join(widgetDir, 'widget.yml'), uuid);
}

function resolveWidgetDir(widgetTemplate, stencilConfig) {
    const widgetBuilderConfig = stencilConfig.widgetBuilder || null;

    if (widgetBuilderConfig && widgetBuilderConfig.widgetsDir) {
        const configRelative = path.resolve(
            process.cwd(),
            widgetBuilderConfig.widgetsDir,
            widgetTemplate,
        );
        if (fs.existsSync(configRelative)) {
            return configRelative;
        }
    }

    const cwdRelative = path.resolve(process.cwd(), widgetTemplate);
    if (fs.existsSync(cwdRelative)) {
        return cwdRelative;
    }

    return null;
}

async function loadWidgetFiles(widgetDir) {
    const [templateFile, schemaRaw, query] = await Promise.all([
        readFileIfExists(path.join(widgetDir, 'widget.html')),
        readFileIfExists(path.join(widgetDir, 'schema.json')),
        readFileIfExists(path.join(widgetDir, 'query.graphql')),
    ]);

    if (!schemaRaw) {
        throw new Error(`${'schema.json'.cyan} not found or empty in ${widgetDir}`);
    }

    let schemaParsed;
    try {
        schemaParsed = JSON.parse(schemaRaw);
    } catch {
        throw new Error(`Invalid ${'schema.json'.cyan} in ${widgetDir}`);
    }

    // schema.json can be either:
    //   1. A raw array: [{ "type": "tab", ... }, ...]
    //   2. A full config object: { "name": "...", "schema": [...], "template": "..." }
    let schema;
    let nameFromSchema = null;
    let templateFromSchema = null;

    if (Array.isArray(schemaParsed)) {
        schema = schemaParsed;
    } else if (schemaParsed && Array.isArray(schemaParsed.schema)) {
        schema = schemaParsed.schema;
        nameFromSchema = schemaParsed.name || null;
        templateFromSchema = schemaParsed.template || null;
    } else {
        throw new Error(
            `${'schema.json'.cyan} must be an array or an object with a "schema" array property`,
        );
    }

    const template = templateFile || templateFromSchema;
    if (!template) {
        throw new Error(`${'widget.html'.cyan} not found or empty in ${widgetDir}`);
    }

    return { template, schema, query: query || '', nameFromSchema };
}

async function publishToApi({ payload, uuid, accessToken, apiHost, storeHash }) {
    const baseUrl = `${apiHost}/stores/${storeHash}/v3/content/widget-templates`;
    const url = uuid ? `${baseUrl}/${uuid}` : baseUrl;
    const method = uuid ? 'PUT' : 'POST';

    const response = await networkUtils.sendApiRequest({
        url,
        method,
        accessToken,
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify(payload),
    });

    return response.data?.data;
}

async function stencilPublishWidget({ widgetTemplate, apiHost }) {
    const stencilConfigManager = new StencilConfigManager();
    const stencilConfig = await stencilConfigManager.read();

    if (!stencilConfig.accessToken) {
        throw new Error(
            'Missing access token. Please run'.red + ' $ stencil init'.cyan + ' first.'.red,
        );
    }

    const resolvedApiHost = apiHost || stencilConfig.apiHost;
    const storeHash = await themeApiClient.getStoreHash({
        storeUrl: stencilConfig.normalStoreUrl,
    });

    const widgetDir = resolveWidgetDir(widgetTemplate, stencilConfig);
    if (!widgetDir) {
        throw new Error(`Widget template directory not found: ${widgetTemplate}`.red);
    }

    const widgetName = path.basename(widgetDir);
    console.log(`Publishing widget template: ${widgetName.cyan}`);

    const { template, schema, query, nameFromSchema } = await loadWidgetFiles(widgetDir);
    const existingUuid = readTrackedUuid(widgetDir);

    const channelId = stencilConfig.widgetBuilder?.channelId || 1;
    const displayName = nameFromSchema || widgetName;
    const payload = {
        name: displayName,
        schema,
        template,
        storefront_api_query: query,
        channel_id: channelId,
    };

    try {
        const data = await publishToApi({
            payload,
            uuid: existingUuid,
            accessToken: stencilConfig.accessToken,
            apiHost: resolvedApiHost,
            storeHash,
        });

        if (!existingUuid && data?.uuid) {
            writeTrackedUuid(widgetDir, data.uuid);
            console.log('New publishes will now update instead of creating a new instance'.green);
        }

        const action = existingUuid ? 'updated' : 'published';
        console.log(`${'ok'.green} -- ${widgetName} successfully ${action}!`);
    } catch (err) {
        if (err.response?.status === 403) {
            throw new Error(
                'Widget publish API returned 403. Ensure your access token has the '.red +
                    '"content manage"'.cyan +
                    ' scope.'.red,
            );
        }
        if (err.response?.data) {
            const detail = JSON.stringify(err.response.data, null, 2);
            throw new Error(`Failed to publish widget "${widgetName}": ${err.message}\n${detail}`);
        }
        throw err;
    }
}

export default stencilPublishWidget;
