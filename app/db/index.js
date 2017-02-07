const mysql = require('mysql'),
	Bird = require('bluebird'),
	map = require('lodash/map');

class DB {
	constructor(config) {
		this._connection = mysql.createConnection(config);
	}

	connect() {
		let connection = this._connection;
		return new Bird(resolve => {
			connection.connect(err => {
				if(!err) {
					resolve(connection);
				} else {
					throw err;
				}
			});
		});
	}

	showDBs() {
		return this.executeQuery("SHOW DATABASES;").then(r => {
			return r.results;
		});
	}

	showTables(dbname) {
		return this.executeQuery("SHOW TABLES;").then(r => {
			let tables = [];
			r.results.forEach(row => {
				tables.push({
					Database: dbname,
					Table: row[`Tables_in_${dbname}`]
				});
			});
			return tables;
		});
	}

	dropTable(tableName) {
		return this.executeQuery(`DELETE TABLE \`${tableName}\`` );
	}

	truncateTable(tableName) {
		return this.executeQuery(`TRUNCATE TABLE \`${tableName}\``);
	}

	getRows(table) {
		return this.executeQuery(`SHOW INDEXES from \`${table}\` WHERE Key_name='PRIMARY'`).then(def => {
			return this.executeQuery(`SELECT * FROM \`${table}\` LIMIT 500`).then(data => {
				data.primaryKeys = map(def.results, 'Column_name');
				return data;
			});
		});
	}

	delete() {

	}

	executeQuery(query, bindings = []) {
		return new Bird(resolve => {
			this._connection.query(query, bindings, (err, results, fields) => {
				if(err) {
					throw err;
				} else {
					// console.log(fields);
					resolve({results, fields});
				}
			});
		});
	}
}

module.exports = function(options) {
	return new DB(options);
};