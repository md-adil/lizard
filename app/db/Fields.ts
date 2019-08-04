import Field from "./Field";

class Fields {
    public fields: Field[];
    public readonly primaryKeys: string[] = [];

    constructor(fields: any[]) {
        this.fields = fields.map((field: any) => {
            if (field.Key === "PRI") {
                this.primaryKeys.push(field.Field);
            }
            return new Field(field);
        });
    }
}

export default Fields;
