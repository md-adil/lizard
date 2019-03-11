import { IConnectionState } from "../actions/connection";
import * as connection from "../actions/connection";
import * as React from "react";
import { connect } from "react-redux";
import CreateConnection from "../components/CreateConnection";
import { AppState } from "../store";


interface IProps {
    connection: IConnectionState;
    onCancel?: any;
}

interface IState {
    errors: any;
    values: any;
}

class CreateConnectionContainer extends React.Component<IProps, IState> {
    public state = {
        values: {},
        errors: {},
        isCreating: false,
    }

    public handleCancel = () => {
    }

    public handleChange = () => {

    }

    public handleSubmit = () => {

    }


    public render() {
        return (
            <CreateConnection
                onChange={this.handleChange}
                onSubmit={this.handleSubmit}
                values={this.state.values}
                errors={this.state.values}
                onCancel={this.props.onCancel}
                visible={this.props.connection.isCreating}
                />
        );
    }
}

const mapStateToProps = ({ connection }: AppState) => ({ connection });
const mapDispatchToProps = ({ dispatch }: any) => ({
    onCancel: () => dispatch(connection.isCreating(false)),
    update: (connection: any) => dispatch(connection.update(connection))
})

export default connect(mapStateToProps)(CreateConnectionContainer);
