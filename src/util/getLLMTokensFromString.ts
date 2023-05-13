export const getLLMTokensFromString = (str: string) => {
    const tokens: string[] = []
    let nextToken = ''
    for (const char of str.split('')) {
        nextToken = nextToken.concat(char)
        if (nextToken.length >= 4) { // Apparently a token is around 4 characters
            tokens.push(nextToken)
            nextToken = ''
        }
    }
    if (nextToken.length > 0) {
        tokens.push(nextToken)
    }
    return tokens
}
