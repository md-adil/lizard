const tabCreator = using('render/tabs');
using('vendors.notify')($);

class Data {
	constructor(options) {
		log(options);
		this._db = options.db;
		this._dbname = options.dbname;
		this._$container = $('#home');
		this.tabCreator = tabCreator($('#app-body'));
		this.bindEvents();
	}

	render(tableName) {
		return this._db.getRows(tableName).then( ( data ) => {
			log('fetch table data: ', data);
			this.tabCreator.add(tableName,  this.make(data, tableName), this._dbname + '-' + tableName);
		});
	}

	bindEvents() {

	}

	/**
	* Needs to be refactor
	*/
	make(data, tableName) {
		let results = data.results,
			fields = data.fields,
			pks = data.primaryKeys;
		log('Fields: ', fields);
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
				var input = $('<input />');
				input.val(r[fname.name]);
				input.data({
					table: tableName,
					condition: this.generateCondition(pks, r),
					field: fname.name
				});
				log(input.data());
				this.bindUpdateEvent(input);
				col.append(input);
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

	generateCondition(pks, row) {
		var c = [];
		pks.forEach(pk => {
			c.push(pk + '=' + row[pk]);
		});
		return c.join(' AND ');
	}

	bindUpdateEvent(input) {
		log('Input:', input.val());
		var _self = this;
		input.on('change', function(e) {
			log('chaning values', e.target);
			var data = $(this).data();
			data.value = $(this).val();
			_self.updateData(data).then(r => {
				input.notify('Updated!', {position: "right",className:'success',autoHideDelay: 1000});
			});
		});
	}

	updateData(data) {
		return this._db.executeQuery(`UPDATE \`${data.table}\` SET \`${data.field}\`=? WHERE ${data.condition}`, [data.value]);
	}
}

module.exports = function(options) {
	return new Data(options);
};
