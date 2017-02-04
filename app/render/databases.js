const db = using('db');
const tableRenderer = using('render/tables');

class Database {

	constructor(options) {
		this._options = options;
		this._db = db(options);
	}

	render() {
		let ul = $('<ul />');
		return this._db.connect().then(connection => {
			return this._db.showDBs().then(data => {
				data.forEach(row => {
					ul.append(this.make(row));
				});
				return {
					connection: connection,
					el: ul
				};
			});
		});
	}

	make(data) {
		let el = $('<a />'),
			dbname = data.Database;
		el.text(dbname);
		el.data('dbname', dbname);
		this.bindEvents(el);
		return $('<li />').append(el);
	}

	bindEvents(el) {
		el.dblclick(e => {
			e.preventDefault();
			this.showTables($(e.target));
		});
	}

	showTables(el) {
		log('show tables');
		let options = $.extend({}, this._options);
		options.database = el.data('dbname');
		let _db = db(options);
		_db.connect().then(connection => {
			let renderer = tableRenderer({
				db: _db,
				dbname: options.database
			});
			renderer.render(connection.threadId);
		});

		log(options);
	}
}

module.exports = function(options) {
	return new Database(options);
};
