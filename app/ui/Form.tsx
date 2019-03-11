import * as React from "react";
import { createForm } from "rc-form";
import Button from "./Button";

interface IFormProps extends React.FormHTMLAttributes<HTMLFormElement> {
    children: React.ReactNode;
}

interface IFieldProps {
    children: React.ReactNode;
    label?: string;
    error?: null|string
}

interface ITextProps extends React.InputHTMLAttributes<HTMLInputElement>{
}

interface IControlProps {
    children: React.ReactNode;
}

interface ISubmitProps {
    children: React.ReactNode;
}

export const Field = ({children, label,error}: IFieldProps) => (
    <div className="ui-form-field">
        { label && <label>{label}</label> }
        {children}
        {error && <div className="ui-field-error">{error}</div> }
    </div>
);

export const Text = (props: ITextProps) => (
    <input type="text" name={name} {...props} />
)


export const Submit = ({children,...props}: ISubmitProps) => <Button htmlType="submit" {...props}>{children}</Button>

class Form extends React.Component<IFormProps> {
    public static Field = Field;
    public static create = createForm;
    public static Text = Text;
    public static Submit = Submit;

    public render() {
        const { children, ...props } = this.props;
        return (
            <form {...props} className="ui-form">
                {this.props.children}
            </form>
        );
    }
}

export default Form;
