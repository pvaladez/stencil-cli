#!/usr/bin/env node
import 'colors';
import program from '../lib/commander.js';
import { PACKAGE_INFO } from '../constants.js';
import { prepareCommand, printCliResultErrorAndExit } from '../lib/cliCommon.js';
import stencilPublishWidget from '../lib/stencil-publish-widget.js';

program
    .version(PACKAGE_INFO.version)
    .arguments('<widget-template>')
    .description('Publish a widget template to your BigCommerce store')
    .usage('<widget-template> [options]');

const cliOptions = prepareCommand(program);
const widgetTemplate = program.args[0];

if (!widgetTemplate) {
    console.error('Error: please provide a widget template name'.red);
    program.help();
}

stencilPublishWidget({
    widgetTemplate,
    apiHost: cliOptions.host,
}).catch(printCliResultErrorAndExit);
