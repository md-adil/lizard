import Database from "./Database";
import { IConnectionConfig } from "../actions/connection";
import Query from "./query";

class Connection {
    public id: string;
    public name: string;
    public isConnected: boolean = false;
    public isConnecting: boolean = false;
    protected config: IConnectionConfig;
    private connection: Query | null = null;

    constructor(conf: IConnectionConfig) {
        this.name = conf.name;
        this.config = conf;
        this.id = conf.id;
    }

    public async connect() {
        const connection = new Query(this.config);
        await connection.execute("SELECT 1 + 1 as result");
        this.connection = connection;
    }

    public async databases(): Promise<Database[]> {
        if (!this.connection) {
            return [];
        }
        const db = await this.connection.fetchAll("SHOW DATABASES");
        return db.map((dbname: any) => {
            return new Database(dbname.Database, this.config);
        });
    }

    public toJSON() {
        return this.config;
    }
}

export default Connection;
