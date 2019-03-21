import Database from "./Database";
import { IConnection } from "../actions/connection";
import * as Knex from "knex";

class Connection {
    public name: string;
    protected config: IConnection;
    protected knex: Knex;

    constructor(conf: IConnection) {
        this.name = conf.name;
        this.config = conf;
        // this.knex = Knex({
        //     client: "mysql2",
        //     connection: {
        //         host : conf.host,
        //         user : conf.user,
        //         password : conf.password
        //     }
        // });
    }

    public async verify() {
        return this.knex.raw("SELECT 1");
    }

    public databases(): Promise<Database[]> {
        return new Promise(() => {});
    }
}

export default Connection;
