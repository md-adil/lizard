import * as React from "react";
import { connect } from "react-redux";
import Connection from "../components/Connection";
import * as connection from "../actions/connection";
import * as database from "../actions/database";
import { Dispatch } from "redux";

interface IProps {
    connection: connection.IConnection;
    dispatch: any;
}

interface IState {
    databases: database.IDatabase[];
}

class ConnectionContainer extends React.Component<IProps, IState> {
    public state = {
        databases: []
    };

    public handleConnect = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
    }

    public async componentDidMount() {
        const knex = this.props.connection.db;
        if (!knex) {
            return;
        }
        const databases = await knex.raw("SWOW databases");
        console.log(database);
    }

    public render() {
        return <Connection onConnect={this.handleConnect} connection={this.props.connection} />;
    }
}

const mapDispatch = (dispatch: Dispatch) => ({ dispatch });

export default connect(null, mapDispatch)(ConnectionContainer);
