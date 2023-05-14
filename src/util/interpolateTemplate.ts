export const interpolateTemplate = (template: string, values: Record<string, string>) => {
    Object.entries(values).forEach(([key, value]) => {
        template = template.replaceAll(`{${key}}`, value)
    })
    return template
}
