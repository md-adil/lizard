import * as React from "react";
import Button from "../ui/Button";
import Connection from "../db/Connection";
import "./connection-list.scss";
import Spinner from "../ui/Spinner";
interface IProps {
    onAddConnection: any;
    connections: Connection[];
}

const DatabaseNames = (props: any) => {
    return (
        <div>{props.database.name}</div>
    );
}

const useDatabase = (init: any) => {
    const [databases, setDatabase] = React.useState(init);
    const [isConnecting, setIsConnecting] = React.useState(false);
    return [databases, isConnecting, async (e: any, connection: any) => {
        e.preventDefault();
        setIsConnecting(true);
        await connection.connect();
        setIsConnecting(false);
        const db = await connection.databases();
        setDatabase(db);
    }];
}

const ConnectionListItem = ({connection}: {connection: Connection}) => {
    const [ databases, isConnecting, loadDatabase ] = useDatabase([]);
    return (
        <div className="connection-list-item">
            <a href="#" onClick={e => loadDatabase(e, connection) }>{ isConnecting && <Spinner size={14} /> }{connection.name}</a>
            <div className="databases">
                {databases.map((db: any) => <DatabaseNames key={db.name} database={db} />)}
            </div>
        </div>
    );
} 


export default (props: IProps) => (
    <div className="connection-list">
        {props.connections.map((item: Connection) => <ConnectionListItem key={item.id} connection={item} />)}
    </div>
);
