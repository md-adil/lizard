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
const { useState } = React;
interface IProps {
    onAddConnection: any;
    connections: Connection[];
}

interface IDatabaseProps {
    database: Database;
}

const DatabaseComponent = (props: IDatabaseProps) => {
    const [loading, setLoading] = useState(false);
    const database = props.database;
    const loadResults = async () => {
        setLoading(true);
        const tables = await database.tables();
        store.dispatch(
            content.add({
                title: `tables in ${database.name}`,
                content: (
                    <TableListContainer tables={tables} database={database} />
                )
            })
        );
        setLoading(false);
    };

    return (
        <div onClick={loadResults}>
            {loading && <Spinner />}
            {props.database.name}
        </div>
    );
};

const useDatabase = (init: any) => {
    const [databases, setDatabase] = React.useState(init);
    const [isConnecting, setIsConnecting] = React.useState(false);
    return [
        databases,
        isConnecting,
        async (e: any, connection: any) => {
            e.preventDefault();
            setIsConnecting(true);
            await connection.connect();
            setIsConnecting(false);
            const db = await connection.databases();
            setDatabase(db);
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
                {databases.map((db: Database) => (
                    <DatabaseComponent key={db.name} database={db} />
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
