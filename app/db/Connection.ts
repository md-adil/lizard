import Database from "./Database";
import { IConnectionConfig } from "../store/connection/action";
import Query from "./query";
import * as mysql from "mysql";

class Connection {
    public id: string;
    public name: string;
    public isConnected: boolean = false;
    public isConnecting: boolean = false;
    protected config: IConnectionConfig;
    protected queryBuilder?: Query;

    constructor(conf: IConnectionConfig) {
        this.name = conf.name;
        this.config = conf;
        this.id = conf.id;
    }

    public async connect() {
        const connection = mysql.createConnection({ ...this.config });
        const builder = new Query(connection);
        await builder.query("SELECT 1 + 1 as result").execute();
        this.queryBuilder = builder;
    }

    public async databases(): Promise<Database[]> {
        if (!this.queryBuilder) {
            return [];
        }
        const db = await this.queryBuilder.query("SHOW DATABASES").fetchAll();
        return db.map((dbname: any) => {
            return new Database(
                dbname.Database,
                mysql.createConnection({
                    ...this.config,
                    database: dbname.Database
                })
            );
        });
    }

    public toJSON() {
        return this.config;
    }
}

export default Connection;
