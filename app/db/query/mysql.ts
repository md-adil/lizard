import IQuery from "./QueryInterface";
import { IConnectionConfig } from "../../store/connection/action";
import mysql = require("mysql");

class Query implements IQuery {
    protected connection: mysql.Connection;
    protected myQuery?: string;
    constructor(conn: mysql.Connection) {
        this.connection = conn;
    }

    public query(q: string) {
        this.myQuery = q;
        return this;
    }

    public execute(): Promise<any> {
        return new Promise<void>((res, rej) => {
            this.connection.query(this.myQuery || "", (err, _, __) => {
                if (err) {
                    rej(err);
                } else {
                    res();
                }
            });
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
