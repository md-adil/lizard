import * as React from "react";
import { connect } from "react-redux";
import ConnectionComponent from "../components/Connection";
import { Dispatch } from "redux";
import Connection from "../db/Connection";
import Database from "../db/Database";

interface IProps {
    connection: Connection;
    dispatch: any;
}

interface IState {
    databases: Database[];
}

class ConnectionContainer extends React.Component<IProps, IState> {
    public state = {
        databases: []
    };

    public handleConnect = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
    }

    public async componentDidMount() {
        this.setState({
            databases: await this.props.connection.databases()
        });
    }

    public render() {
        return <ConnectionComponent connection={this.props.connection} />;
    }
}

const mapDispatch = (dispatch: Dispatch) => ({ dispatch });

export default connect(null, mapDispatch)(ConnectionContainer);
