import * as React from "react";
import { IConnection } from "../actions/connection";

export interface IProps {
    connection: IConnection;
    onConnect: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

export default ({connection, onConnect}: IProps) => (
    <div>
        <a onClick={onConnect}>{connection.name}</a>
    </div>
);
