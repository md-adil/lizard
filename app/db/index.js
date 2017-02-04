const mysql = require('mysql'),
	Bird = require('bluebird');

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
		return this.executeQuery("DELETE TABLE " + tableName);
	}

	truncateTable(tableName) {
		return this.executeQuery("TRUNCATE TABLE " + tableName);
	}

	fetchData(table) {
		return this.executeQuery(`SELECT * FROM ${table} LIMIT 1000`);
	}

	delete() {

	}

	executeQuery(query) {
		return new Bird(resolve => {
			this._connection.query(query, (err, results, fields) => {
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