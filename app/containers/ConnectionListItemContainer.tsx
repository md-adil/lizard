import * as React from "react";
import { connect } from "react-redux";
import * as connection from "../store/connection/action";
import { Dispatch } from "redux";
import Connection from "../db/Connection";

interface IProps {
    connection: Connection;
    dispatch: any;
}

class ConnectionListItemContainer extends React.Component<IProps> {
    public handleConnect = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        this.props.dispatch(connection.connect(this.props.connection));
    };

    public render() {
        return null;
    }
}

const mapDispatch = (dispatch: Dispatch) => ({ dispatch });

export default connect(
    null,
    mapDispatch
)(ConnectionListItemContainer);
