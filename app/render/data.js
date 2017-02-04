const tabCreator = using('render/tabs');
class Data {
	constructor(options) {
		log(options);
		this._db = options.db;
		this._dbname = options.dbname;
		this._$container = $('#home');
		this.tabCreator = tabCreator($('#app-body'));

	}

	render(tableName) {
		return this._db.fetchData(tableName).then( ( data )=> {
			global.mytab = this.tabCreator.add(tableName,  this.make(data), this._dbname + '-' + tableName);
		});
	}

	/**
	* Needs to be refactor
	*/
	make(data) {
		let results = data.results,
			fields = data.fields;
		let table = $('<table />', {class: 'table table-striped'});
		let heading = $('<tr />');
		fields.forEach(col => {
			heading.append(`<th>${col.name}</th>`);
		});
		heading = $('<thead />').append(heading);
		table.append(heading);
		let tbody = $('<tbody />');
		results.forEach(r => {
			var row = $('<tr />');
			fields.forEach(fname => {
				var col = $('<td />');
				col.append(r[fname.name]);
				row.append(col);
			});
			tbody.append(row);
		});
		table.append(tbody);
		return table;
	}

	fields() {
		return 'adil';
	}

	bindEvents(el) {
		el.dblclick(e => {
			e.preventDefault();
			let tab = this.tabCreator.add('hello world', 'This is Adil');
			// this.showTables($(e.target));
		});
	}
}

module.exports = function(options) {
	return new Data(options);
};
