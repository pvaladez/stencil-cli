# Stencil CLI (with Widget Builder)

[![npm (scoped)](https://img.shields.io/npm/v/@bigcommerce/stencil-cli.svg)](https://www.npmjs.com/package/@bigcommerce/stencil-cli)
![tests](https://github.com/bigcommerce/stencil-cli/workflows/Tests/badge.svg?branch=master)

The BigCommerce server emulator for local theme development — extended with local widget preview and a CLI publishing command.

Unlike the standalone [Widget Builder](https://developer.bigcommerce.com/docs/storefront/widgets/widget-builder), this fork renders a live, non-published preview of your local widget templates directly inside the Stencil theme you're developing. That means you can see exactly how a widget will look in context — placed in the right region, styled by your theme's CSS — without having to publish it to your store first. When you're ready, the `stencil-wb publish-widget` command pushes the widget template to your store in a single step.

---

## `stencil-wb` — Widget Builder CLI

### Installing

Install the fork globally from GitHub:

```bash
npm install -g oBundle/stencil-cli#widget-builder
```

This gives you both the standard `stencil` commands and the new `stencil-wb` command.

### Configuration

#### 1. Set the widgets directory in `config.stencil.json`

Add a `widgetBuilder` block to your theme's `config.stencil.json` to tell `stencil-wb` where your widget template folders live:

```json
{
  "widgetBuilder": {
    "widgetsDir": "./templates/components/custom/widgets"
  }
}
```

The `widgetsDir` path is relative to your theme root (wherever `config.stencil.json` is).

You can optionally specify a `channelId` if your store uses multiple storefronts (defaults to `1`):

```json
{
  "widgetBuilder": {
    "widgetsDir": "./templates/components/custom/widgets",
    "channelId": 1
  }
}
```

#### 2. Create a widget template folder

Each widget template is its own folder inside the `widgetsDir` directory. The folder name is used as the widget template name (unless overridden in `schema.json`).

A widget template folder should contain:

| File             | Required | Description                                                           |
| ---------------- | -------- | --------------------------------------------------------------------- |
| `schema.json`    | Yes      | Widget Builder schema defining the settings UI (tabs, sections, fields). Can also contain `name` and `template` properties. |
| `widget.html`    | Yes*     | Handlebars template for the widget markup. *Can be omitted if `template` is provided inline in `schema.json`. |
| `config.json`    | Yes      | Configuration values for the widget. Used to populate the local preview. (Future improvement: fall back to `default` values from `schema.json` when this file is absent.) |

#### Example folder structure

```
widgets/
├── placements.mjs
└── my-banner/
    ├── schema.json
    ├── widget.html
    └── config.json
```

#### Example `schema.json`

```json
{
  "name": "My Banner",
  "schema": [
    {
      "type": "tab",
      "label": "Content",
      "sections": [
        {
          "label": "Text",
          "settings": [
            {
              "type": "input",
              "id": "heading",
              "label": "Heading",
              "default": "Hello World"
            },
            {
              "type": "input",
              "id": "subtitle",
              "label": "Subtitle",
              "default": "Welcome to my store"
            }
          ]
        }
      ]
    }
  ]
}
```

The top-level object can also include a `template` property with inline HTML, which is used instead of `widget.html` if that file is absent. A raw array (just the `schema` portion) is also accepted.

#### Example `widget.html`

```handlebars
<section class="my-banner">
  <h2>{{heading}}</h2>
  <p>{{subtitle}}</p>
</section>
```

#### Example `config.json`

```json
{
  "heading": "Hello World",
  "subtitle": "Welcome to my store"
}
```

#### 3. Create `placements.mjs`

A single `placements.mjs` file lives directly inside the `widgetsDir` directory. It controls which widgets appear on which pages/regions and in what order. The `.mjs` extension ensures Node.js treats it as an ES module regardless of your theme's `package.json` settings.

The file must export a `placements` array. Each object in the array specifies a page type, a region, and a `widgets` list of widget folder names. The order of folder names in the `widgets` array determines the rendering order of the widget previews.

```js
export const placements = [
    {
        page_type: 'home',
        region: 'page_builder_content_1',
        widgets: ['hero-carousel', 'my-banner'],
    },
    {
        page_type: 'product',
        region: 'product_below_content--global',
        widgets: ['related-items'],
    },
];
```

| Property    | Required | Description                                                                                  |
| ----------- | -------- | -------------------------------------------------------------------------------------------- |
| `page_type` | Yes      | The page type to match (e.g. `home`, `product`, `category`, `brand`, `page`).                |
| `region`    | Yes      | The theme region to render the widgets into. Append `--global` for global regions.           |
| `widgets`   | Yes      | Ordered array of widget folder names. Widgets render in the listed order.                    |
| `position`  | No       | `'prepend'` (default) or `'append'` — controls whether the group is placed before or after existing region content. |
| `entity_id` | No       | Restrict the placement to a specific entity (e.g. a particular product or category ID).      |

> **Future improvement:**
> - A new `{{widget-builder}}` Handlebars helper to place widget previews directly in your templates wherever the helper is used.

### Publishing a Widget Template

From your theme directory (where `config.stencil.json` lives), run:

```bash
stencil-wb publish-widget <widget-template-folder>
```

The `<widget-template-folder>` argument is just the **folder name** — not a full or relative path. It is resolved relative to the `widgetsDir` configured in `config.stencil.json`.

For example, given this structure:

```
widgets/
└── my-banner/
    ├── schema.json
    └── widget.html
```

You would run:

```bash
stencil-wb publish-widget my-banner
```

#### What happens when you publish

- **First publish:** The widget template is **created** on your store via the BigCommerce API. A `widget.yml` file is written inside the widget folder containing the template's UUID. This is the same tracking file that Widget Builder uses.
- **Subsequent publishes:** The command detects the existing `widget.yml` and **updates** the widget template in place instead of creating a duplicate.

The `widget.yml` file should be committed to version control so that all team members update the same widget template rather than creating new ones.

> **Note:** Your API token must have the **content manage** scope. If you haven't already, run `stencil-wb init` to configure your store credentials.

---

## Install

Note: Stencil requires the Node.js runtime environment,
versions 20.x, 22.x are supported.

Run `npm install -g @bigcommerce/stencil-cli`.

Visit the [installation guide](https://developer.bigcommerce.com/stencil-docs/getting-started/installing-stencil)
for more details.

## Usage

```text
Usage: stencil [options] [command]

Commands:

  init        Interactively create a .stencil file which configures how to run a BigCommerce store locally.
  start       Starts up the BigCommerce storefront local development environment, using theme files in the current directory and data from the live store.
  bundle      Bundles up the theme into a zip file which can be uploaded to BigCommerce.
  release     Create a new release in the theme's github repository.
  push        Bundles up the theme into a zip file and uploads it to your store.
  pull        Pulls the configuration from the active theme on your live store and updates your local configuration.
  download    Downloads the theme files from the active theme on your live store.
  debug       Prints environment and theme settings for debug purposes.
  help [cmd]  display help for [cmd]

Options:

  -h, --help     output usage information
  -V, --version  output the version number
```

Run `stencil init` at the top level of your Stencil Theme. It will ask you a few questions to get your started.

Run `stencil start` to run a local server so you can start developing your theme.

Run with `-o` or `--open` to automatically open up a browser.

-   While stencil is running, you can type "rs" and then hit enter to auto-reload all browsers. This is similar to
    Nodemon's rs option.

Run `stencil bundle` to validate your code and create a zip bundle file that can be uploaded to BigCommerce.

Run `stencil release` to tag a new version of your theme, create a [GitHub release](https://help.github.com/articles/about-releases/)
in your theme repository, and upload the zip bundle file to the release assets.
This is useful for tracking your changes in your Theme, and is the tool we use to create new releases in BigCommerce
[Cornerstone](https://github.com/bigcommerce/stencil) theme.

Run `stencil push` to bundle the local theme and upload it to your store, so it will be available in My Themes.
To push the theme and also activate it, use `stencil push -a`. To automatically delete the oldest theme if you are at
your theme limit, use `stencil push -d`. These can be used together, as `stencil push -a -d`. You can apply the theme to
multiple storefronts, just specify ids of desired storefronts/channels after `-c` option `stencil push -a -c 123 456 789`.
If you want to apply theme to all available storefronts, just use `-allc` option: `stencil push -a -allc`.

Run `stencil pull` to sync changes to your theme configuration from your live store. For example, if Page Builder has
been used to change certain theme settings, this will update those settings in config.json in your theme files so you
don't overwrite them on your next upload.

Run `stencil debug` to get information about runtime environment and the configuration

## Features

### BrowserSync

Stencil CLI comes packaged with BrowserSync so you can take advantage of all of those amazing goodies!
Have a look at their [web site](http://www.browsersync.io/) for more information.

### Sass compiling

You can compile Sass (node-sass) scss files in assets/scss into CSS. For example, add an scss file named theme.scss
to assets/scss and `{{{stylesheet 'assets/css/theme.css'}}}` to your theme HTML template. Stencil-CLI will compile
assets/scss/theme.scss to CSS on the fly.

### Autoprefixer

Stencil CLI comes packaged with [Autoprefixer](https://github.com/postcss/autoprefixer). You can set which browsers
should be targeted, as well as if it should cascade the generated rules in the theme's config.json file with these
options:

-   `autoprefixer_cascade` - Defaults to `true`.
-   `autoprefixer_browsers` - Defaults to `["> 1%", "last 2 versions", "Firefox ESR"]`.

## How to get help or report a bug

If you need any help or experience any bugs, please create a GitHub issue in this repository.

## Development

If you would like to improve this project check out the [Contributing Guide](./CONTRIBUTING.md). Also, you can find
the implementation details there.

## Running in docker

There is possibility to run stencil-cli in docker.
Here are steps to have this functionality.

First, pull the image from Github Packages (docker registry):
`docker pull ghcr.io/bigcommerce/stencil-cli`

Then, you want to run some commands against your theme.

For example
`docker run -p 3005:3005 -v /bigcommerce/cornerstone:/usr/src/app -it ghcr.io/bigcommerce/stencil-cli stencil init`, where `3005` is port number definded in `config.stencil.json` and `/bigcommerce/cornerstone` path to where theme is located.

`docker run -p 3005:3005 -v /bigcommerce/cornerstone:/usr/src/app -it ghcr.io/bigcommerce/stencil-cli stencil start` and so on

## License

Copyright (c) 2015-present, BigCommerce Inc.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. All advertising materials mentioning features or use of this software
   must display the following acknowledgement:
   This product includes software developed by BigCommerce Inc.
4. Neither the name of BigCommerce Inc. nor the
   names of its contributors may be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY BIGCOMMERCE INC ''AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL BIGCOMMERCE INC BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
