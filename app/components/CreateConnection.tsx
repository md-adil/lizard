import * as React from "react";
import Modal from "../ui/Modal";
import Form from "../ui/Form";

interface IProps {
    visible: boolean;
    values: any;
    errors: any;
    onChange: (evt: React.FormEvent<HTMLInputElement>) => void;
    onCancel: () => void;
    onSubmit: (evt: React.FormEvent<HTMLFormElement>) => void;
}

export default ({values, onCancel, onChange, errors, onSubmit, visible}: IProps) => (
    <Modal
        title="Add connection"
        visible={visible}
        onClose={onCancel}>
        <Form onSubmit={onSubmit}>
            <Form.Field label="Connection name" error={errors.name}>
                <Form.Text name="name" onChange={onChange} value={values.name} />
            </Form.Field>
            <Form.Field label="Host">
                <Form.Text name="host" onChange={onChange} value={values.host} />
            </Form.Field>
            <Form.Field label="Port">
                <Form.Text name="port" onChange={onChange} value={values.port} />
            </Form.Field>
            <Form.Field label="User">
                <Form.Text name="user" onChange={onChange} value={values.user} />
            </Form.Field>
            <Form.Field label="Password">
                <Form.Text name="password" onChange={onChange} value={values.password} />
            </Form.Field>
            <Form.Field>
                <Form.Submit>Save</Form.Submit>
            </Form.Field>
        </Form>
    </Modal>
);
