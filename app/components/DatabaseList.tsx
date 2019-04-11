import * as React from "react";
import Database from "../db/Database";

interface IProps {
    databases: Database[];
    onSelect: (db: Database, evt: React.MouseEvent<HTMLDivElement>) => void;
}

export default (props: IProps) => (
    <div>
        {props.databases.map((database: Database) => <div key={database.name} onClick={props.onSelect.bind(null, database)}>{database.name}</div>)}
    </div>
);
