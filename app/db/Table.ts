import Database from "./Database";

class Table {
    public name = "";
    public isConnected = false;
    private database: Database;
    constructor(database: Database, name: string) {
        this.name = name;
        this.database = database;
    }

    public records() {
        return this.database.query().fetchAll(`SELECT * FROM ${this.name} LIMIT 1000`);
    }

    public async fields() {
        const fields = await this.database.query().fetchAll(`EXPLAIN ${this.name}`);
        return fields.map((f: any) => f.Field);
    }
}

export default Table;
