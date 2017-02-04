const Conf = require('conf');
let conf = new Conf();
global.using = function(filename) {
	return require(__dirname + '/' + filename);
};

global.log = console.log.bind(console);

global.config = function(key, val) {
	if(val) {
		return conf.set(key, val);
	}

	if(key) {
		return conf.get(key);
	}

	return conf;
};
