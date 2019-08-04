import IQuery from "./QueryInterface";
import { IConnectionConfig } from "../../store/connection/action";
import mysql = require("mysql");

class Query implements IQuery {
    public bindings: any[] = [];
    protected connection: mysql.Connection;
    protected myQuery?: string;
    constructor(conn: mysql.Connection) {
        this.connection = conn;
    }

    public query(q: string, bindings: any[] = []) {
        this.myQuery = q;
        this.bindings = bindings;
        return this;
    }

    public execute(): Promise<any> {
        return new Promise<void>((res, rej) => {
            this.connection.query(
                this.myQuery || "",
                this.bindings,
                (err, _, __) => {
                    if (err) {
                        rej(err);
                    } else {
                        res();
                    }
                }
            );
        });
    }

    public fetch() {
        if (!this.myQuery) {
            throw new Error("Please select any query");
        }
        return new Promise<any>((res, rej) => {
            this.connection.query(
                this.myQuery || "",
                (err, results, fields) => {
                    console.log({ fields });
                    if (err) {
                        rej(err);
                    } else {
                        res(results[0]);
                    }
                }
            );
        });
    }

    public fetchAll() {
        return new Promise<any>((res, rej) => {
            this.connection.query(
                this.myQuery || "",
                (err?: Error, results?: any[], fields?: any) => {
                    if (err) {
                        rej(err);
                    } else {
                        res(results);
                    }
                }
            );
        });
    }
}

export default Query;
