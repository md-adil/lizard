import * as React from "react";
import { IConnectionState } from "../actions/connection";
import CreateConnectionContainer from "../containers/CreateConnectionContainer";
import Button from "../ui/Button";
import ConnectionContainer from "../containers/ConnectionListItemContainer";

interface IProps {
    connection: IConnectionState;
    onAddConnection: any;
}

export default (props: IProps) => (
    <div>
        <Button onClick={props.onAddConnection}>Add one</Button>
        <div className="connection-list">
            {props.connection.data.map((list) => <ConnectionContainer key={list.id} connection={list} />)}
        </div>
        <CreateConnectionContainer />
    </div>
);
