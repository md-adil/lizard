import IQuery from "./QueryInterface";
import { IConnectionConfig } from "../../actions/connection";
import mysql = require("mysql");

class Query implements IQuery {
    protected config: IConnectionConfig;
    protected connection: mysql.Connection;
    constructor(config: IConnectionConfig, dbname?: string) {
        this.config = config;
        if (dbname) {
            this.connection = mysql.createConnection({
                host: config.host,
                user: config.user,
                database: dbname
            });
        } else {
            this.connection = mysql.createConnection({
                host: config.host,
                user: config.user
            });
        }
    }

    public execute(q: string): Promise<any> {
        return new Promise<void>((res, rej) => {
            this.connection.query(q, (err, _, __) => {
                if (err) {
                    rej(err);
                } else {
                    res();
                }
            });
        });
    }

    public fetch(query: string) {
        return new Promise<any>((res, rej) => {
            this.connection.query(query, (err, results, fields) => {
                if (err) {
                    rej(err);
                } else {
                    res(results[0]);
                }
            });
        });
    }

    public fetchAll(query: string) {
        return new Promise<any>((res, rej) => {
            this.connection.query(query, (err, results, fields) => {
                if (err) {
                    rej(err);
                } else {
                    res(results);
                }
            });
        });
    }
}

export default Query;
