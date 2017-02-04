require('./../app/globals');
const $ = require('jquery'),
	fs = require('fs');
window.jQuery = $;
require('devtron').install();
require('bootstrap');
const connectionRenderer = using('render/connections')();
connectionRenderer.load();
using('home')(connectionRenderer);
