import * as React from "react";
import CreateConnectionContainer from "../containers/CreateConnectionContainer";
import Button from "../ui/Button";
import ConnectionContainer from "../containers/ConnectionListItemContainer";
import Connection from "../db/Connection";

interface IProps {
    onAddConnection: any;
    connections: Connection[];
}

export default (props: IProps) => (
    <div>
        <Button onClick={props.onAddConnection}>Add one</Button>
        <div className="connection-list">
            {props.connections.map((item: Connection) => <ConnectionContainer key={item.id} connection={item} />)}
        </div>
        <CreateConnectionContainer />
    </div>
);
