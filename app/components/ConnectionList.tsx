import * as React from "react";
import { IConnection, IConnectionState } from "../actions/connection";
import CreateConnectionContainer from "../containers/CreateConnectionContainer";
import Button from "../ui/Button";

interface IProps {
    connection: IConnectionState;
    onAddConnection: any;
}

export default (props: IProps) => (
    <div>
        <Button onClick={props.onAddConnection}>Add one</Button>
        <div className="connection-list">
            { props.connection.data.map((list) => <div key={list.name} className="connection-list-item">
                <div>{list.name}</div>
                </div>)
            }
        </div>
        <CreateConnectionContainer />
    </div>
);
