import Query from "./query";
import Table from "./Table";
import * as mysql from "mysql";

class Database {
    public name: string;
    private connection: any;

    constructor(dbname: string, connection: mysql.Connection) {
        this.name = dbname;
        this.connection = connection;
    }

    public async tables(): Promise<Table[]> {
        const tables = await this.getBuilder()
            .query("SHOW TABLES")
            .fetchAll();
        return tables.map((t: any) => {
            return new Table(this, t[`Tables_in_${this.name}`]);
        });
    }

    public query(q: string): Query {
        return this.getBuilder().query(q);
    }

    public getBuilder(): Query {
        return new Query(this.connection);
    }
}

export default Database;
