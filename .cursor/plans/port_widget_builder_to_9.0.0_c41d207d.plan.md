---
name: Port Widget Builder to 9.0.0
overview: Re-implement the widget-builder integration from the pv/widget-builder branch (based on 8.10.x) onto the pv/widget-builder-9.0.0 branch (based on 9.0.0), adapting for API changes in the new version.
todos:
  - id: create-local-widget-renderer
    content: Create lib/local-widget-renderer.js -- copy from old branch verbatim
    status: completed
  - id: modify-stencil-start
    content: Modify lib/stencil-start.js -- add widget config reading, pass to server and BrowserSync, add file watcher
    status: completed
  - id: modify-server-index
    content: Modify server/index.js -- pass widgetsDir, apiHost, storeHash to renderer plugin
    status: completed
  - id: modify-renderer-module
    content: Modify server/plugins/renderer/renderer.module.js -- import local-widget-renderer, inject widget HTML into formattedRegions
    status: completed
  - id: modify-package-json
    content: Modify package.json -- rename to stencil-cli-wb, rename bin entries to stencil-wb-*
    status: completed
  - id: fix-store-settings
    content: Fix store-settings-api-client.js -- default shopper_language_selection_method instead of throwing (if still needed)
    status: completed
  - id: npm-link
    content: Run npm link to register stencil-wb command
    status: completed
isProject: false
---

# Port Widget Builder Integration to 9.0.0

## What changed between 8.10.x and 9.0.0

Key differences that affect the port:

- **`stencil-start.js`**: `getChannelInfo()` was renamed to `getChannelUrl()` and now returns just the URL string instead of a `{ url, channel_id }` object. The `channelId` parameter was removed from `getStoreSettingsLocale()`. The `run()` method no longer has `channelInfo` -- just `channelUrl`.
- **`store-settings-api-client.js`**: Completely rewritten -- no longer accepts `channelId`, no longer has the `getStoreSettingsLocaleWithChannel` helper. The old branch's fix (defaulting `shopper_language_selection_method` instead of throwing) is NOT in 9.0.0 -- decide if still needed.
- **`renderer.module.js`**: New binary content handling was added (lines 118-132), but the region-building code (lines 230-235) is unchanged -- the injection point is the same.
- **`server/index.js`**: Unchanged between versions.
- **`package.json`**: Version is 9.0.0, bumped dependencies (`stencil-paper` 5.4.1, `stencil-styles` 6.2.6, Node >= 20).

## Files to create/modify

### 1. Create [`lib/local-widget-renderer.js`](lib/local-widget-renderer.js) (new file)

Copy verbatim from the old branch. This file has no dependencies on anything that changed in 9.0.0. It imports `colors`, `fs`, `path`, `uuid4`, and `NetworkUtils` -- all present in 9.0.0.

### 2. Modify [`lib/stencil-start.js`](lib/stencil-start.js)

Adapt the old branch's changes to the 9.0.0 code structure:

- Add `import localWidgetRenderer from './local-widget-renderer.js'` (line 18)
- In `run()` (after line 72): read `widgetBuilder` config from `initialStencilConfig`, resolve `widgetsDir` path, compute `apiHost` and `storeHash`, then pass them to `startLocalServer()` and `startBrowserSync()`

The key adaptation: in 8.10.x the old code extracted `apiHost` from `cliOptions`/`updatedStencilConfig`. In 9.0.0, `this.storeHash` is already set by `getChannelUrl()`, so we can reference it directly. The pattern is the same:

```javascript
const widgetBuilderConfig = initialStencilConfig.widgetBuilder || null;
let resolvedWidgetsDir = null;
if (widgetBuilderConfig && widgetBuilderConfig.widgetsDir) {
    resolvedWidgetsDir = path.resolve(
        this._themeConfigManager.themePath,
        widgetBuilderConfig.widgetsDir,
    );
    this._logger.log(`Widget Builder enabled: ${resolvedWidgetsDir}`.cyan);
}

const apiHost = cliOptions.apiHost || updatedStencilConfig.apiHost;
await this.startLocalServer(cliOptions, updatedStencilConfig, {
    widgetsDir: resolvedWidgetsDir,
    apiHost,
    storeHash: this.storeHash,
});
```

- Modify `startLocalServer()` signature to accept `widgetBuilderOpts` and spread the three new options into `Server.create()`
- Modify `startBrowserSync()` to accept `widgetsDir` and add the widget file watcher block (identical to old branch)

### 3. Modify [`server/index.js`](server/index.js)

Add three lines after the `storeSettingsLocale` assignment (after current line 38):

```javascript
pluginsByName['./plugins/renderer/renderer.module.js'].widgetsDir = options.widgetsDir || null;
pluginsByName['./plugins/renderer/renderer.module.js'].apiHost = options.apiHost || null;
pluginsByName['./plugins/renderer/renderer.module.js'].storeHash = options.storeHash || null;
```

Identical to old branch -- no 9.0.0 changes needed.

### 4. Modify [`server/plugins/renderer/renderer.module.js`](server/plugins/renderer/renderer.module.js)

- Add `import localWidgetRenderer from '../../../lib/local-widget-renderer.js'` near other imports (after line 14)
- After `formattedRegions` is built (after line 235), insert the widget rendering block -- identical to old branch:

```javascript
if (internals.options.widgetsDir && pageType) {
    try {
        console.log(`[Widget Builder] Rendering widgets for pageType=${pageType}, entityId=${entityId}`);
        const widgetEntries = await localWidgetRenderer.getRenderedWidgetsForPage({
            widgetsDir: internals.options.widgetsDir,
            pageType,
            entityId,
            accessToken: internals.options.accessToken,
            apiHost: internals.options.apiHost,
            storeHash: internals.options.storeHash,
        });
        if (widgetEntries.length > 0) {
            console.log(`[Widget Builder] Injecting ${widgetEntries.length} widget(s) into regions: ${widgetEntries.map((e) => e.region).join(', ')}`);
        } else {
            console.log(`[Widget Builder] No matching widgets for this page`);
        }
        localWidgetRenderer.mergeWidgetRegions(formattedRegions, widgetEntries);
    } catch (err) {
        console.error(`Widget Builder error: ${err.message}`.red);
    }
}
```

### 5. Modify [`package.json`](package.json)

- Change `name` to `"@bigcommerce/stencil-cli-wb"`
- Rename all `bin` entries from `stencil-*` to `stencil-wb-*` (and `stencil` to `stencil-wb`)

### 6. Decide: [`lib/store-settings-api-client.js`](lib/store-settings-api-client.js) fix

The old branch changed the `shopper_language_selection_method` check from throwing to defaulting. The 9.0.0 version still throws. If your store still has this issue, apply the same fix:

```javascript
// Instead of throwing when missing, default it
if (!data.shopper_language_selection_method) {
    data.shopper_language_selection_method = 'default_shopper_language';
}
```

## What does NOT need porting

- `bin/stencil-attributes-analyzer.js` and `bin/stencil-scss-autofix.js` -- the old branch diff shows 0 bytes changed (just whitespace/permissions); skip.
- `package-lock.json` -- will be regenerated by `npm install` after `package.json` changes.

## Post-implementation

After all edits, run `npm link` from the repo to register the `stencil-wb` command globally.
