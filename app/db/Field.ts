import Fields from "./Fields";

class Field {
    public static create(fields: any): Field[] {
        const primaryKeys: string[] = [];
        const fieldsObject = fields.map((f: any) => {
            const field = new Field(f);
            if (field.isPrimary) {
                primaryKeys.push(field.name);
            }
            return field;
        });
        fieldsObject.forEach(
            (field: Field) => (field.primaryKeys = primaryKeys)
        );
        return fieldsObject;
    }

    public readonly isPrimary: boolean = false;
    public readonly name: string;
    public readonly type: string;
    public readonly default: string;
    public readonly isNull: boolean = false;
    public readonly isIncrementing: boolean = false;

    public primaryKeys: string[] = [];

    constructor(field: any) {
        if (field.Key === "PRI") {
            this.isPrimary = true;
        }
        this.name = field.Field;
        this.type = field.Type;
        this.default = field.Default;
        if (field.Null === "YES") {
            this.isNull = true;
        }
    }
}

export default Field;
