import * as React from "react";
import Button from "./Button";
import classnames from "classnames";

interface IFormProps extends React.FormHTMLAttributes<HTMLFormElement> {
    children: React.ReactNode;
}

interface IFieldProps {
    children: React.ReactNode;
    label?: string;
    className?: any;
    error?: null | string;
}

interface ITextProps extends React.InputHTMLAttributes<HTMLInputElement> {}
interface ITextAreaProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    children?: string;
}

interface IControlProps {
    children: React.ReactNode;
}

interface ISubmitProps {
    children: React.ReactNode;
}

export const Field = ({ children, className, label, error }: IFieldProps) => (
    <div className={classnames("ui-form-field", className)}>
        {label && <label>{label}</label>}
        {children}
        {error && <div className="ui-field-error">{error}</div>}
    </div>
);

export const Text = ({ className, ...props }: ITextProps) => (
    <input
        type="text"
        className={classnames("ui ui-input", className)}
        {...props}
    />
);

export const TextArea = ({ children, className, ...props }: ITextAreaProps) => (
    <textarea className={classnames("ui ui-textarea", className)} {...props}>
        {children}
    </textarea>
);

export const Input = Text;

export const Submit = ({ children, ...props }: ISubmitProps) => (
    <Button htmlType="submit" {...props}>
        {children}
    </Button>
);

class Form extends React.Component<IFormProps> {
    public static Field = Field;
    public static Text = Text;
    public static Input = Text;
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
