import Database from "./Database";
import * as mysql from "mysql";
import Field from "./Field";
import * as _ from "lodash";

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

    public async fields(): Promise<Field[]> {
        const fields = await this.database
            .query(`EXPLAIN ${this.name}`)
            .fetchAll();
        return Field.create(fields);
    }

    public async update(conditions: any, values: any) {
        const bindings: any[] = [];
        const v = _.map(values, (val, key) => {
            bindings.push(val);
            return `${key} = ?`;
        }).join(",");

        const c = _.map(conditions, (val, key) => {
            bindings.push(val);
            return `${key} = ?`;
        }).join(" AND ");

        return this.database
            .query(`UPDATE ${this.name} SET ${v} WHERE ${c}`, bindings)
            .execute();
    }
}

export default Table;
