import * as React from "react";
import Modal from "../ui/Modal";
import Form from "../ui/Form";
interface IProps {
    visible: boolean;
}

export default (props: IProps) => (
    <Modal visible={props.visible} onClose={this.props.onCancelCreating}>
        <Form>Create connection</Form>
    </Modal>
);
