import * as React from "react";
import Button from "../ui/Button";
import Connection from "../db/Connection";
import "./connection-list.scss";
import Spinner from "../ui/Spinner";
import Dropdown from "../ui/Dropdown";
import store from "../store";
import * as content from "../store/content/action";
import TableListContainer from "../containers/TableListContainer";
import Database from "../db/Database";
import DatabaseContainer from "../containers/DatabaseContainer";
const { useState } = React;
interface IProps {
    onAddConnection: any;
    connections: Connection[];
}

const useDatabase = (init: any) => {
    const [databases, setDatabase] = React.useState(init);
    const [isConnecting, setIsConnecting] = React.useState(false);
    return [
        databases,
        isConnecting,
        async (e: any, connection: any) => {
            e.preventDefault();
            setIsConnecting(true);
            try {
                await connection.connect();
                const db = await connection.databases();
                setDatabase(db);
            } catch (err) {
                alert(err.message);
            }
            setIsConnecting(false);
        }
    ];
};

const ConnectionListItem = ({ connection }: { connection: Connection }) => {
    const [databases, isConnecting, loadDatabase] = useDatabase([]);
    const overlay = (
        <ul>
            <li>Edit</li>
            <li>Delete</li>
        </ul>
    );
    return (
        <div className="connection-list-item">
            <a href="#" onClick={e => loadDatabase(e, connection)}>
                {isConnecting && <Spinner size={14} />}
                {connection.name}
            </a>
            <div className="databases">
                {databases.map((database: Database) => (
                    <DatabaseContainer database={database} />
                ))}
            </div>
            <Dropdown overlay={overlay}>
                <Button>...</Button>
            </Dropdown>
        </div>
    );
};

export default (props: IProps) => (
    <div className="connection-list">
        {props.connections.map((item: Connection) => (
            <ConnectionListItem key={item.id} connection={item} />
        ))}
    </div>
);
