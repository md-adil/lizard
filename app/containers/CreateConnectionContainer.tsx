import * as connection from "../store/connection/action";
import React from "react";
import { connect } from "react-redux";
import CreateConnection from "../components/CreateConnection";
import { AppState } from "../store";
import * as shortid from "shortid";
import Connection from "../db/Connection";
import { IConnectionConfig } from "../store/connection/types";

interface IProps {
    isCreating: boolean;
    onCancel?: any;
    dispatch: any;
}

interface IState {
    errors: any;
    values: IConnectionConfig;
}

class CreateConnectionContainer extends React.Component<IProps, IState> {
    public state = {
        values: {
            id: shortid.generate(),
            name: "",
            host: "",
            user: "",
            password: "",
            type: "",
            isConnected: false
        },
        errors: {}
    };

    public handleCancel = () => {
        this.props.dispatch(connection.creating(false));
    };

    public handleChange = (e: React.FormEvent<HTMLInputElement>) => {
        this.setState({
            values: {
                ...this.state.values,
                [e.currentTarget.name]: e.currentTarget.value
            }
        });
    };

    public handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        this.props.dispatch(connection.add(new Connection(this.state.values)));
    };

    public render() {
        return (
            <CreateConnection
                onChange={this.handleChange}
                onSubmit={this.handleSubmit}
                values={this.state.values}
                errors={this.state.values}
                onCancel={this.handleCancel}
                visible={this.props.isCreating}
            />
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    connection: state.connection,
    isCreating: state.connection.isCreating
});
const mapDispatchToProps = (dispatch: any) => ({ dispatch });

export default connect(mapStateToProps)(CreateConnectionContainer);
