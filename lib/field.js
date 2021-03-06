const validator = require("validator");
const FilterPrototype = validator.Filter.prototype;
const ValidatorPrototype = validator.Validator.prototype;
const externalFilter = new validator.Filter();
const externalValidator = new validator.Validator();
const object = require("object-additions").object;
const async = require("async");
const utils = require("./utils");

function Field(property, label) {
    const stack = [];
    let isArray = false;
    const fieldLabel = label || property;

    this.name = property;
    this.__required = false;
    this.__trimmed = false;

    this.add = function(func) {
        stack.push(func);
        return this;
    };

    this.array = function() {
        isArray = true;
        return this;
    };

    this.run = function (source, request, options, cb) {
        const self = this;
        const form = request.form;
        const errors = [];
        let value = utils.getProp(property, form) || utils.getProp(property, source);

        if (options.autoTrim && !self.__trimmed) {
            self.__trimmed = true;
            stack.unshift(function (value) {
                if (object.isString(value)) {
                    return FilterPrototype.trim.apply(externalFilter.sanitize(value));
                }
                return value;
            });
        }

        function runStack(foo, cb) {
            async.eachSeries(stack, function(proc, cb) {
                if (proc.length === 4) {
                    // run the async validator/filter
                    return proc(foo, source, request, function(err, result) {
                        if (err) {
                            errors.push(err.message.replace("%s", fieldLabel));
                            return cb(null);
                        }

                        // filters return values
                        if (result != null) {
                            foo = result
                        }

                        cb(null);
                    });
                }

                if (proc.length === 3) {
                    // run the async validator/filter
                    return proc(foo, source, function(err, result) {
                        if (err) {
                            errors.push(err.message.replace("%s", fieldLabel));
                            return cb(null);
                        }

                        // filters return values
                        if (result != null) {
                            foo = result
                        }

                        cb(null);
                    });
                }

                // run the sync validator/filter
                const result = proc(foo, source);
                if (result.valid) {
                    return cb(null);
                }
                if (result.error) {
                    // If this field is not required and it doesn't have a value, ignore error.
                    if (!utils.hasValue(value) && !self.__required) {
                        return cb(null);
                    }

                    errors.push(result.error.replace("%s", fieldLabel));
                    return cb(null);
                }
                foo = result;
                cb(null);

            }, function(err) {
                cb(null, foo);
            });
        }

        if (isArray) {
            const isRequired = stack.map(f => f.name).includes('isRequired');
            if (!utils.hasValue(value) && isRequired) {
                errors.push(`${this.name} is required`);
                cb(null, errors);
                return;
            } else if (!utils.hasValue(value)) {
                value = [];
            }
            if (!Array.isArray(value)) {
                value = [value];
            }
            async.mapSeries(value, runStack, function(err, value) {
                utils.setProp(property, form, value);
                cb(null, errors);
            });
        } else {
            if (Array.isArray(value)) {
                value = value[0];
            }
            runStack(value, function(err, value) {
                utils.setProp(property, form, value);
                cb(null, errors);
            });
        }
    };
}

// ARRAY METHODS
Field.prototype.array = function () {
    return this.array();
};

Field.prototype.arrLength = function (from, to) {
    return this.add(function (arr) {
        if (value.length < from) {
            return { error: message || e.message || "%s is too short" };
        }
        if (value.length > to) {
            return { error: message || e.message || "%s is too long" };
        }
        return { valid: true };
    });
};

// HYBRID METHODS

Field.prototype.custom = function(func, message) {

    // custom function is async and needs the request
    if (func.length === 4) {
        return this.add(function(value, source, request, cb) {
            func(value, source, request, function(err, result) {
                if (err) {
                    return cb(new Error(message || err.message || "%s is invalid"));
                }

                // functions that return values are filters
                if (result != null) {
                    return cb(null, result);
                }

                // value passed validator
                cb(null, null);
            });
        });
    }

    // custom function is async
    if (func.length === 3) {
        return this.add(function(value, source, cb) {
            func(value, source, function(err, result) {
                if (err) {
                    return cb(new Error(message || err.message || "%s is invalid"));
                }

                // functions that return values are filters
                if (result != null) {
                    return cb(null, result);
                }

                // value passed validator
                cb(null, null);
            });
        });
    }

    // custom function is sync
    return this.add(function (value, source) {
        let result;
        try {
            result = func(value, source);
        } catch (e) {
            return { error: message || e.message || "%s is invalid" };
        }
        // Functions that return values are filters.
        if (result != null) {
            return result;
        }

        // value passed validator
        return { valid: true };

    });
};

// FILTER METHODS

Object.keys(FilterPrototype).forEach(function (name) {
    if (name.match(/^ifNull$/)) {
        return;
    }

    Field.prototype[name] = function () {
        const args = arguments;
        return this.add(function (value) {
            const a = FilterPrototype[name].apply(externalFilter.sanitize(value), args);
            return a;
        });
    };
});

Field.prototype.ifNull = function (replacement) {
    return this.add(function (value) {
        if (object.isUndefined(value) || null === value || '' === value) {
            return replacement;
        }
        return value;
    });
};

Field.prototype.toUpper = Field.prototype.toUpperCase = function () {
    return this.add(function (value) {
        return value.toString().toUpperCase();
    });
};

Field.prototype.toLower = Field.prototype.toLowerCase = function () {
    return this.add(function (value) {
        return value.toString().toLowerCase();
    });
};

Field.prototype.truncate = function (length) {
    return this.add(function (value) {
        value = value.toString();
        if (value.length <= length) {
            return value;
        }

        if (length <= 3) {
            return "...";
        }

        if (value.length > length - 3) {
            return value.substr(0,length - 3) + "...";
        }

        return value;
    });
};

Field.prototype.customFilter = function (func) {
    return this.add(func);
};

// VALIDATE METHODS

var MESSAGES = {
    isDate: "%s is not a date",
    isUrl: "%s is not a URL",
    isIP: "%s is not an IP address",
    isAlpha: "%s contains non-letter characters",
    isAlphanumeric: "%s contains non alpha-numeric characters",
    isNumeric: "%s is not numeric",
    isLowercase: "%s contains uppercase letters",
    isUppercase: "%s contains lowercase letters",
    isInt: "%s is not an integer",
    notEmpty: "%s has no value or is only whitespace"
};

Object.keys(ValidatorPrototype).forEach(function (name) {
    if (name.match(/^(contains|notContains|equals|check|validate|assert|error|len|isNumeric|isDecimal|isEmail|isFloat|regex|notRegex|is|not|notNull|isNull)$/)) {
        return;
    }

    Field.prototype[name] = function (message) {
        const args = arguments;
        message = message || MESSAGES[name];

        return this.add(function(value) {
            try {
                ValidatorPrototype[name].apply(externalValidator.check(value, message), args);
            } catch (e) {
                return { error: e.message || e.toString() };
            }
            return { valid: true };
        });
    };
});

Field.prototype.contains = function (test, message) {
    return this.add(function(value) {
        try {
            ValidatorPrototype.contains.call(externalValidator.check(value, message), test);
        } catch (e) {
            return { error: message || "%s does not contain required characters" };
        }
        return { valid: true };
    });
};

Field.prototype.notContains = function (test, message) {
    return this.add(function (value) {
        try {
            ValidatorPrototype.notContains.call(externalValidator.check(value, message), test);
        } catch (e) {
            return { error: message || "%s contains invalid characters" };
        }
        return { valid: true };
    });
};


Field.prototype.equals = function (other, message) {
    if (object.isString(other) && other.match(/^field::/)) {
        this.__required = true;
    }

    return this.add(function (value, source) {
        // If other is a field token (field::fieldname), grab the value of fieldname
        // and use that as the OTHER value.
        let test = other;
        if (object.isString(other) && other.match(/^field::/)) {
            test = utils.getProp(other.replace(/^field::/, ""), source);
        }
        if (value != test) {
            return { error: message || "%s does not equal " + String(test) };
        }
        return { valid: true };
    });
};

// node-validator's numeric validator seems unintuitive. All numeric values should be valid, not just int.
Field.prototype.isNumeric = function (message) {
    return this.add(function (value) {
        if (object.isNumber(value) || (object.isString(value) && value.match(/^[-+]?[0-9]*\.?[0-9]+$/))) {
            return { valid: true };
        } else {
            return { error: message || "%s is not a number" };
        }
    });
};

// node-validator's decimal/float validator incorrectly thinks Ints are valid.
Field.prototype.isFloat = Field.prototype.isDecimal = function (message) {
    return this.add(function (value) {
        if ((object.isNumber(value) && value % 1 == 0) || (object.isString(value) && value.match(/^[-+]?[0-9]*\.[0-9]+$/))) {
            return { valid: true };
        } else {
            return { error: message || "%s is not a decimal" };
        }
    });
};

// super simple email validation
Field.prototype.isEmail = function (message) {
    return this.add(function (value) {
        if (typeof value != 'string' || !(/^[\-0-9a-zA-Z\.\+_]+@[\-0-9a-zA-Z\.\+_]+\.[a-zA-Z]{2,}$/).test(value)) {
            return { error: message || "%s is not an email address" };
        }
        return { valid: true };
    });
};

Field.prototype.isString = function (message) {
    return this.add(function (value) {
        if (!object.isString(value)) {
            return { error: message || "%s is not a string" };
        }
        return { valid: true };
    });
};

Field.prototype.regex = Field.prototype.is = function (pattern, modifiers, message) {
    // regex(/pattern/)
    // regex(/pattern/, "message")
    // regex("pattern")
    // regex("pattern", "modifiers")
    // regex("pattern", "message")
    // regex("pattern", "modifiers", "message")

    if (pattern instanceof RegExp) {
        if (object.isString(modifiers) && modifiers.match(/^[gimy]+$/)) {
            throw new Error("Invalid arguments: `modifiers` can only be passed in if `pattern` is a string.");
        }

        message = modifiers;
        modifiers = undefined;

    } else if (object.isString(pattern)) {
        if (arguments.length == 2 && !modifiers.match(/^[gimy]+$/)) {
            // 2nd arg doesn't look like modifier flags, it's the message (might also be undefined)
            message = modifiers;
            modifiers = undefined;
        }
        pattern = new RegExp(pattern, modifiers);
    }

    return this.add(function (value) {
        if (pattern.test(value) === false) {
            return { error: message || "%s has invalid characters" };
        }
        return { valid: true };
    });
};

Field.prototype.notRegex = Field.prototype.not = function(pattern, modifiers, message) {
    // notRegex(/pattern/)
    // notRegex(/pattern/, "message")
    // notRegex("pattern")
    // notRegex("pattern", "modifiers")
    // notRegex("pattern", "message")
    // notRegex("pattern", "modifiers", "message")

    if (pattern instanceof RegExp) {
        if (object.isString(modifiers) && modifiers.match(/^[gimy]+$/)) {
            throw new Error("Invalid arguments: `modifiers` can only be passed in if `pattern` is a string.");
        }

        message = modifiers;
        modifiers = undefined;

    } else if (object.isString(pattern)) {
        if (arguments.length == 2 && !modifiers.match(/^[gimy]+$/)) {
            // 2nd arg doesn't look like modifier flags, it's the message (might also be undefined)
            message = modifiers;
            modifiers = undefined;
        }
        pattern = new RegExp(pattern, modifiers);
    }

    return this.add(function(value) {
        if (pattern.test(value) === true) {
            return { error: message || "%s has invalid characters" };
        }
        return { valid: true };
    });
};

Field.prototype.required = function (placeholderValue, message) {
    this.__required = true;
    return this.add(function isRequired (value) {
        if (!utils.hasValue(value) || value == placeholderValue) {
            return { error: message || "%s is required" };
        }
        return { valid: true };
    });
};

Field.prototype.minLength = function (length, message) {
    return this.add(function(value) {
        if (value.toString().length < length) {
            return { error: message || "%s is too short" };
        }
        return { valid: true };
    });
};

Field.prototype.maxLength = function (length, message) {
    return this.add(function(value) {
        if (value.toString().length > length) {
            return { error: message || "%s is too long" };
        }
        return { valid: true };
    });
};

Field.prototype.customValidator = function(func, message) {
    return this.add(function(value, source) {
        try {
            func(value, source);
        } catch (e) {
            return { error: message || e.message || "%s is invalid" };
        }
        return { valid: true };
    });
};

module.exports = Field;
