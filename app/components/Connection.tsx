import * as React from "react";
import { IConnection } from "../actions/connection";
import Connection from "../db/Connection";

export interface IProps {
    connection: Connection;
}

export default (props: IProps) => (
    <div>
        <aside>
            Databases
            <ul>
                <li>
                    <a href="">Database</a>
                </li>
            </ul>
        </aside>
        <main>
            Lorem ipsum
        </main>
    </div>
);
