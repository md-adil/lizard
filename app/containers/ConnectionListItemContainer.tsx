import * as React from "react";
import { connect } from "react-redux";
import Connection from "../components/ConnectionListItem";
import * as connection from "../actions/connection";
import * as connectedConnection from "../actions/connectedConnection";
import { Dispatch } from "redux";

interface IProps {
    connection: connection.IConnection;
    dispatch: any;
}

class ConnectionListItemContainer extends React.Component<IProps> {

    public handleConnect = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        this.props.dispatch(connectedConnection.connect(this.props.connection));
    }

    public render() {
        return <Connection onConnect={this.handleConnect} connection={this.props.connection} />;
    }
}

const mapDispatch = (dispatch: Dispatch) => ({ dispatch });

export default connect(null, mapDispatch)(ConnectionListItemContainer);
