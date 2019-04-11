import Query from "./query";
import Table from "./Table";

class Database {
    public name: string;
    private connection: any;
    private queryBuilder: Query;

    constructor(dbname: string, connection: any) {
        this.name = dbname;
        this.connection = connection;
        this.queryBuilder = new Query(connection, dbname);
    }

    public async tables(): Promise<Table[]> {
        const tables = await this.queryBuilder.fetchAll("SHOW TABLES");
        return tables.map((t: any) => {
            return new Table(this, t[`Tables_in_${this.name}`]);
        });
    }

    public query(): Query {
        return this.queryBuilder;
    }
}

export default Database;
