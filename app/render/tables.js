const dataRenderer = using('render.data');
class Table {
	constructor(options) {
		log(options);
		this._db = options.db;
		this._dbname = options.dbname;
		this._$container = $('#home');
		this.dataRenderer = dataRenderer(options);

	}

	render(threadId) {
		this._$container.empty();
		let ul = $('<ul />');
		log('showing data for ' + this._dbname);
		return this._db.showTables(this._dbname).then(data => {
			data.forEach(row => {
				ul.append(this.make(row));
			});
			this._$container.append(ul);
		});
	}

	make(data) {
		let el = $('<a />');
		el.text(data.Table);
		el.data('_db', this._db);
		el.data('_table', data.Table);

		this.bindEvents(el);
		return $('<li />').append(el);
	}

	bindEvents(el) {
		el.dblclick(e => {
			let $el = $(e.target);
			e.preventDefault();
			this.dataRenderer.render($el.data('_table'));
		});
	}
}

module.exports = function(options) {
	return new Table(options);
};
