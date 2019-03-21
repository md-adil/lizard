import Database from "./Database";
import { IConnection } from "../actions/connection";

class Connection {
    public name: string;
    protected config: IConnection;
    constructor(con: IConnection) {
        this.name = con.name;
        this.config = con;
    }

    public databases(): Database[] {
        return [];
    }
}

export default Connection;
