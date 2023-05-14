export const getLLMTokensFromString = (str: string) => {
    const tokens: string[] = []
    const chars = str.split('')
    for (let i = 0; i < chars.length; i += 4) {
        tokens.push(chars.slice(i, i + 4).join('')) // Apparently a token is around 4 characters
    }
    return tokens
}
