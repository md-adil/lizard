import Database from "./Database";
import * as mysql from "mysql";

class Table {
    public name: string;
    public database: Database;
    constructor(database: Database, name: string) {
        this.name = name;
        this.database = database;
    }

    public records() {
        return this.database
            .query(`SELECT * FROM ${this.name} LIMIT 1000`)
            .fetchAll();
    }

    public async fields() {
        const fields = await this.database
            .query(`EXPLAIN ${this.name}`)
            .fetchAll();
        return fields.map((f: any) => f);
    }
}

export default Table;
