import * as React from "react";
import { IConnection } from "../actions/connection";

export interface IProps {
    connection: IConnection;
    onConnect: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

export default ({connection, onConnect}: IProps) => (
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
