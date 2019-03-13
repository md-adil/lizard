import { IConnectionState } from "../actions/connection";
import * as connection from "../actions/connection";
import * as React from "react";
import { connect } from "react-redux";
import CreateConnection from "../components/CreateConnection";
import { AppState } from "../store";


interface IProps {
    connection: IConnectionState;
    onCancel?: any;
    dispatch: any;
}

interface IState {
    errors: any;
    values: connection.IConnection;
}

class CreateConnectionContainer extends React.Component<IProps, IState> {
    public state = {
        values: {
            name: "",
            host: "",
            user: "",
            password: "",
            type: "",
        },
        errors: {},
    }

    public handleCancel = () => {
        this.props.dispatch(connection.isCreating(false));
    }

    public handleChange = (e: React.FormEvent<HTMLInputElement>) => {
        this.setState({values: { ...this.state.values, [e.currentTarget.name]: e.currentTarget.value } });
    }

    public handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        this.props.dispatch(connection.add(this.state.values));
    }


    public render() {
        return (
            <CreateConnection
                onChange={this.handleChange}
                onSubmit={this.handleSubmit}
                values={this.state.values}
                errors={this.state.values}
                onCancel={this.handleCancel}
                visible={this.props.connection.isCreating}
                />
        );
    }
}

const mapStateToProps = ({ connection }: AppState) => ({ connection });
const mapDispatchToProps = (dispatch: any) => ({dispatch})

export default connect(mapStateToProps)(CreateConnectionContainer);
