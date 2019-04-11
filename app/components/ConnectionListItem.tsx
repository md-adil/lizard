import * as React from "react";
import Connection from "../db/Connection";

export interface IProps {
    connection: Connection;
    onConnect: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

export default ({connection, onConnect}: IProps) => (
    <div>
        <a onClick={onConnect}>{connection.name}</a>
    </div>
);
